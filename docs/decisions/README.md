# Architecture decision records

Each record captures one significant decision, its context, the options
considered, and its consequences. Every record applies the decision test in
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md).

Records are numbered and never renumbered. A superseded record stays in place
and is marked with the record that replaces it.

| Record | Title | Status |
| --- | --- | --- |
| [0001](0001-local-first-file-workspace.md) | Local-first, file-based moderation workspace | Accepted; amended by 0004 |
| [0002](0002-python-core-typescript-ui.md) | Python core with a TypeScript UI and one data contract | Superseded by 0004 |
| [0003](0003-provider-boundary-and-spend-control.md) | Provider boundary, prompt versioning, and spend control | Accepted; key and spend in the proxy under 0004 |
| [0004](0004-typescript-browser-core-and-local-proxy.md) | TypeScript browser core, folder workspace, and a local thin proxy | Accepted |
