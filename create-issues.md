# /create-issues

Convert a project spec or prompt into a list of GitHub issues.

## Instructions

1. Read `docs/project-spec.md` (or use the input provided by the user)
2. Break the features and tasks down into individual GitHub issues
3. For each issue:
   - Write a clear, actionable title
   - Add a short description of what needs to be done and any acceptance criteria
   - Add appropriate labels: `feature`, `bug`, `enhancement`, `milestone-1`, etc.
4. Use the GitHub CLI to create all issues in the repo:
   ```bash
   gh issue create --title "[title]" --body "[body]" --label "[label]"
   ```
5. List all created issues with their URLs when done

## Usage
```
/create-issues
/create-issues [paste a feature description or milestone here]
```
