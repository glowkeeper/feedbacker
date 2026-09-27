/** Svelte components, for TypeScript (their own types are checked by the Svelte compiler). */
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>;
  export default component;
}
