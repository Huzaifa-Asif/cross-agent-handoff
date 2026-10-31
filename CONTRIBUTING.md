# Contributing

Start with a concrete context-transfer failure and a synthetic fixture. Discuss large schema or adapter changes before implementation. Keep code original or preserve compatible upstream notices; do not contribute company code, real histories, credentials or customer data.

Run all README checks, add regressions and document the actual runtime. Changes to serialization require round-trip and malformed-input tests. Adapter changes must cite current official docs and distinguish manual from native interfaces. No commands in imported context may be executed. Schema changes must have explicit versioning and migration policy; unknown fields must not be silently dropped.

Submit a focused PR with its exact tested commit, commands, results and unrun checks. AI-assisted contributions are welcome when disclosed and independently reviewed; the contributor remains responsible. No CLA or DCO is required by this project. Maintainers must review security-relevant changes before a release. Release notes must distinguish intended support from tested support. No npm package is currently provided.
