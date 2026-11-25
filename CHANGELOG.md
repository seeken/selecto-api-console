# Changelog

## Unreleased

- Show Query profile before Request method in the Request section, since choosing Aggregates or another POST-only profile hides the method choice.

- Section aggregate groups, measures, filters and sort choices by relationship using Detail's field helpers, including root-relative Rows of targets; style the Rows of label consistently.

- Clarify the aggregate target selector as Rows of, with published record labels and help explaining which records filters apply to; keep request values unchanged.

- Group Request method and Query profile in a first Request section, with consecutive visible step numbers and advanced state panels beside the JSON editor.

- Add capability-gated aggregate As of, Rows of targets, typed pivots and subtotal placement; preserve chooser handoffs and render pivot metadata headers.

- Retain canonical Explorer handoff settings in the Aggregates chooser, including row shape, sum null handling, advanced selections and filters, and contract-defined defaults.

- Use the shared three-step chooser for Aggregates with searchable groups and measures, inline aliases and validation, published sorting and subtotals, paging, and profile-aware request links.

- Offer Detail and Aggregates on hosts advertising Explorer aggregate routes without the remote-query profile, and explain unavailable aggregate features beside the disabled option.
- Preserve segment picker choices, server defaults, and explicit Off in chooser handoffs, copied requests, cURL, and remote-query envelopes.
- Examples and fixtures use an invented domain.
