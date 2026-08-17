# FIX REPORT — v1.7.29.48

## Technical Save Freeze

Corrected the TMC → Billing Technical decision boundary.

- If Workbench inserted one or more values into fields that were empty before the TMC writeback, the current Technical page remains on the Save state.
- Closing/Esc/backdrop on the Save Guide only dismisses that visual prompt. It does **not** mark the writeback declined and does **not** recalculate the route to `poll_candidate` while the operator remains in Technical.
- If the operator clicks native Billing `Сохранить`, the existing save-intent + fresh-document verification path is authoritative; a verified save may advance the route immediately.
- If the operator leaves Billing Technical without native Save, Workbench records the durable `declined` decision and only then rescans the destination context so ONU polling can be offered.
- Reload/pageshow while still in Billing Technical does not count as leaving Technical.
- The native Save gate is only created when Workbench actually inserted at least one previously-empty field; already-matching TMC/Billing values do not create a Save obligation.
- v1.7.29.47 Selectize defocus/close behavior is retained.
