import { Component } from "react";
import type { ReactNode } from "react";

/** A failed local renderer/codec load must not discard the report editor. */
export default class ViewerBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="image-empty" role="alert">
          <h3>Renderer could not start</h3>
          <p>
            The local image renderer or a required asset failed to load. Export
            your report before refreshing, then retry the import in a browser
            with WebGL support.
          </p>
        </div>
      );
    return this.props.children;
  }
}
