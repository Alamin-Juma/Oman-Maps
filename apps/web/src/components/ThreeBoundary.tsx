import { Component, type ReactNode } from "react";
import type { Locale } from "@dunialab/content";

export class ThreeBoundary extends Component<{ children: ReactNode; locale: Locale; onClose(): void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { console.error("3D viewer failed", error); }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <section className="panel">
      <p role="alert">{this.props.locale === "sw" ? "3D haipatikani kwa ramani hii kwa sasa" : "3D is not available for this map yet"}</p>
      <button onClick={this.props.onClose}>{this.props.locale === "sw" ? "Rudi kwenye ramani" : "Back to map"}</button>
    </section>;
  }
}
