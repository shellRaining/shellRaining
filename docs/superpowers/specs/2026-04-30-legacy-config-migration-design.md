# Legacy Config Migration Design

## Goal

Migrate existing mixed shellRaining/Pi config fields to the new ownership model while minimizing surprise for existing local setups.

## Background

Existing config supports fields that should no longer be part of shellRaining-owned config:

- `paths.agentDir`
- `paths.skillsDir`
- `agent.providerBaseUrl`
- `agent.showThinking`

The new model keeps shellRaining app settings in shellRaining config and moves Pi runtime settings to Pi profile files.

## Migration Mapping

### `agent.showThinking`

New location:

```txt
telegram.showThinking
```

Reason:

This controls Telegram output rendering, not Pi thinking behavior.

### `paths.agentDir`

New model:

```txt
agents.<id>.piProfile -> derived profile root
```

Reason:

Direct Pi root paths should not be normal shellRaining config. The user selects agent identities and profile ids. shellRaining derives profile roots.

Migration behavior:

- Do not preserve arbitrary `paths.agentDir` as a long-term config field.
- During migration, if `paths.agentDir` exists, map the default agent to a generated legacy profile only if necessary for local continuity.
- Prefer warning users to move Pi files into `~/.shellRaining/pi-profiles/default/`.

### `paths.skillsDir`

New location:

```txt
<profile-root>/settings.json -> skills
```

Example Pi settings:

```json
{
  "skills": ["~/Documents/dotfiles/skills"]
}
```

Migration behavior:

- Do not keep `skillsDir` in shellRaining config.
- Provide a warning that tells users to move the path to the active Pi profile's `settings.json`.
- Optional migration tooling may write the Pi settings entry, but automatic writes should require explicit user action in a separate plan.

### `agent.providerBaseUrl`

New location:

```txt
<profile-root>/models.json
```

Reason:

Provider and model definitions are Pi-owned.

Migration behavior:

- Do not keep `providerBaseUrl` in shellRaining config.
- Warn users to move provider definitions to Pi `models.json`.
- Avoid silently generating provider config because model/provider schema belongs to Pi.

## Warning Strategy

On startup, legacy fields should produce clear warnings:

```txt
Deprecated shellRaining config field paths.skillsDir is ignored by the new config model. Move this value to <profile-root>/settings.json as the Pi settings field skills.
```

Warnings should include:

- Field path
- Whether it is ignored or temporarily mapped
- New destination
- Active profile root when applicable

## Compatibility Window

The first implementation may temporarily read some legacy fields to preserve startup behavior, but new code should normalize them immediately into the new resolved config or warnings.

The main schema should not include legacy fields. Legacy handling should happen before strict schema validation or in a dedicated compatibility parser.

## Non-Goals

- Do not silently rewrite user config files.
- Do not automatically edit Pi profile files without explicit user approval.
- Do not maintain legacy fields indefinitely.
- Do not validate Pi `models.json` or `settings.json`.

## Acceptance Criteria

- Legacy fields are detected and reported clearly.
- `agent.showThinking` has a straightforward migration to `telegram.showThinking`.
- Pi-owned legacy fields are directed to Pi profile files.
- New shellRaining schema remains clean and excludes legacy fields.
- Existing local setups have a documented path to migrate without guessing.
