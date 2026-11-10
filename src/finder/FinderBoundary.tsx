import { Component, type ReactNode } from "react"

// If anything in the finder crashes, show a usable fallback instead of a blank page
// (the rest of the art journal keeps working).
export default class FinderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error("Moyster finder crashed:", error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="mf" id="finder">
        <div className="mf-empty">
          <strong>The oyster finder hit a snag.</strong>
          <button type="button" onClick={() => this.setState({ failed: false })}>
            Try again →
          </button>
          <a href="https://www.google.com/maps/search/oysters+near+me/" target="_blank" rel="noreferrer">
            Or search oysters near you on Google Maps ↗
          </a>
        </div>
      </section>
    )
  }
}
