import type { ClientModule } from 'claude-code'

// One stepper of a band row, `[-]` or `[+]`, drawn by the surface itself: every left-button press posts one
// step to the hooks module (a `ui.message`), which steps that row's agent. It is a Client and not a Button
// because the engine counts quick clicks on one cell as a double or triple click: it selects a word or a line
// in place of the second and third click, and copy-on-select copies it, so a Button hears one click of three.
// While a Client holds the pointer nothing is selected and every press reaches it. Dim at rest, at full
// strength under the pointer, inverted while the button is down.
type Props = { label: string; by: number; agentId: string | null }
type State = { isOver: boolean; isDown: boolean }

const Stepper: ClientModule<Props, State> = (props, surface) => {
  if (surface.state === undefined) {
    // The props a row hands are fixed for its key: which agent, which way.
    surface.onPointer(event => {
      const now = surface.state ?? { isOver: false, isDown: false }
      if (event.type === 'down' && event.button === 'left') {
        surface.post({ by: props.by, agentId: props.agentId })
        surface.setState({ isOver: true, isDown: true })
      } else if (event.type === 'up') surface.setState({ ...now, isDown: false })
      else if (event.type === 'enter') surface.setState({ ...now, isOver: true })
      else if (event.type === 'leave') surface.setState({ isOver: false, isDown: false })
    })
    surface.setState({ isOver: false, isDown: false })
  }
  const { Text } = surface.elements
  return (
    <Text dimColor={surface.state?.isOver !== true} inverse={surface.state?.isDown === true}>
      {props.label}
    </Text>
  )
}

export default Stepper
