# Issue Field guidance

Every tracked Issue should have both its canonical native Type and the
planning metadata used by the repository's configured Project.

## Required when creating an Issue

1. Use the matching Issue template. The template assigns the native GitHub
   Issue Type according to the repository mapping.
2. Add the Issue to the configured Project.
3. Set the Project's `Priority` Field before implementation starts, using the
   values configured by the repository.
4. Keep the Project's `Status` Field aligned with the work lifecycle. Use the
   configured in-progress value when work starts and the configured completed
   value after the work is merged.

The native Issue Type and Project Fields are authoritative planning metadata.
Classification or priority labels must not be used as a substitute for those
Fields. Existing labels may remain temporarily while the migration described
in [issue-type-migration.md](issue-type-migration.md) is completed.

If the Project or a required Field is unavailable, record the limitation in
the Issue and do not invent a replacement label or Field value.
