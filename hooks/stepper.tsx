import type { ClientModule } from 'claude-code'

// One chevron of a band row, `‹` (down) or `›` (up), drawn by the surface itself with a cell either side of it,
// so the whole three-cell region takes the press: the down one's left cell is the row's gutter, where the
// agent in view gets its `▸`. Every left-button press counts one step.
//
// It is a Client and not a Button because the engine counts quick clicks on one cell as a double or triple
// click and selects a word or a line in place of the second and third (copy-on-select copies it); while a
// Client holds the pointer nothing is selected and every press reaches it. A post is delivered at most once a
// frame, a later one replacing one not yet delivered, so each post carries the running count of this
// instance's presses and the hooks module steps by how far it moved: a press whose post was replaced still
// counts. Dim at rest, bright under the pointer, inverted while held.
type Props = { before: string; glyph: string; after: string; by: number; agentId: string | null }
type State = { id: string }
type Pointer = { presses: number; isOver: boolean; isDown: boolean }

// Each instance's presses and pointer state, by the id its state holds; kept here rather than in setState, so a
// press that comes before the instance has drawn again still counts.
const pointers = new Map<string, Pointer>()

const Stepper: ClientModule<Props, State> = (props, surface) => {
  const id = surface.state?.id ?? `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`
  if (surface.state === undefined) surface.setState({ id })
  // Set on every call, so the listener is always this instance's current one.
  surface.onPointer(event => {
    const now = pointers.get(id) ?? { presses: 0, isOver: false, isDown: false }
    let next = now
    if (event.type === 'down' && event.button === 'left') {
      next = { presses: now.presses + 1, isOver: true, isDown: true }
      surface.post({ stepper: id, presses: next.presses, by: props.by, agentId: props.agentId })
    } else if (event.type === 'up') next = { ...now, isDown: false }
    else if (event.type === 'enter') next = { ...now, isOver: true }
    else if (event.type === 'leave') next = { ...now, isOver: false, isDown: false }
    pointers.set(id, next)
    surface.setState({ id })
  })
  const shown = pointers.get(id)
  const { Text } = surface.elements
  return (
    <Text>
      {props.before}
      <Text dimColor={shown?.isOver !== true} inverse={shown?.isDown === true}>
        {props.glyph}
      </Text>
      {props.after}
    </Text>
  )
}

export default Stepper
