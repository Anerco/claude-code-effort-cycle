import type { ClientModule } from 'claude-code'

// One caret of the footer's label, `‹` (down) or `›` (up), drawn by the surface itself with a blank cell either side
// of it, so the whole three-cell region takes the press. The label's hover shows and hides it; its hooks module steps
// the agent the footer shows by `by` for every left-button press.
//
// It is a Client and not a Button because a Button inverts under the pointer, and because the engine counts quick
// clicks on one cell as a double or triple click and selects a word or a line in place of the second and third
// (copy-on-select copies it); while a Client holds the pointer nothing is selected and every press reaches it. A post
// is delivered at most once a frame, a later one replacing one not yet delivered, so each post carries the running
// count of this instance's presses and the hooks module steps by how far it moved: a press whose post was replaced
// still counts. Dim at rest, at full strength under the pointer, and never inverted, held or not.
type Props = { glyph: string; by: number }
type State = { id: string }
type Pointer = { presses: number; isOver: boolean }

// Each instance's presses and whether the pointer is on it, by the id its state holds; kept here rather than in
// setState, so a press that comes before the instance has drawn again still counts.
const pointers = new Map<string, Pointer>()

const Caret: ClientModule<Props, State> = (props, surface) => {
  const id = surface.state?.id ?? `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`
  if (surface.state === undefined) surface.setState({ id })
  // Set on every call, so the listener is always this instance's current one, with its current props.
  surface.onPointer(event => {
    const now = pointers.get(id) ?? { presses: 0, isOver: false }
    let next = now
    if (event.type === 'down' && event.button === 'left') {
      next = { presses: now.presses + 1, isOver: true }
      surface.post({ caret: id, presses: next.presses, by: props.by })
    } else if (event.type === 'enter') next = { ...now, isOver: true }
    else if (event.type === 'leave') next = { ...now, isOver: false }
    pointers.set(id, next)
    if (next.isOver !== now.isOver) surface.setState({ id })
  })
  const { Text } = surface.elements
  return (
    <Text>
      {' '}
      <Text dimColor={pointers.get(id)?.isOver !== true}>{props.glyph}</Text>{' '}
    </Text>
  )
}

export default Caret
