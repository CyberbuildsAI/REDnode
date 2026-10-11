# Game API notes

REDnode's own notes on game types. The generator (`npm run docs:game`) merges them into the game API reference at https://cyberbuildsai.github.io/REDnode/game/.

The type data only has names, types and flags. These notes add what it cannot: what a type is for, when a callback runs, and the traps.

## Format

One file per type, named after the type's **native** name: `PlayerPuppet.md`, `gameObject.md`. The native name is shown on each type page when it differs from the script name.

```markdown
# PlayerPuppet

Text here is the note for the type itself.

## OnGameAttached

Text under a "## Member" heading is the note for that property, method or enum member.
```

- The `# Title` line is optional and ignored.
- A `## Member` heading matches every overload of a method with that name.
- Write in the docs' style: plain, short sentences. Mark anything not tested in game as **unverified**, and link to the test that showed it when there is one.
