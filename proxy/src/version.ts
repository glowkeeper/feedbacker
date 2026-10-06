/** Feedbacker's version (semantic versioning; see CHANGELOG.md). The app, the proxy and the Python core share it. */

import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
