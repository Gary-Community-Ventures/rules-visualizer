# Claude Code Instructions

## Commit Message Workflow

After completing any work, append a short description of the changes to `.git/CLAUDE_MSG`. Use this format:

```
- Brief description of what changed
```

A `prepare-commit-msg` hook prepends this into the commit editor and deletes the file automatically.
