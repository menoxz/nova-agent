# Built-in Profiles

| Profile | Purpose | Policy |
|---|---|---|
| `nova.general` | Safe balanced default | `readonly` |
| `nova.researcher` | Evidence gathering | `readonly` |
| `nova.architect` | Architecture and design plans | `readonly` |
| `nova.builder` | Scoped implementation with gated mutation | `developer` |
| `nova.security` | Security and policy audit | `readonly` |
| `nova.qa` | Independent verification | `ci-eval` |
| `nova.docs` | Documentation/report writing | `readonly` |
| `nova.refactor` | Behavior-preserving refactors | `developer` |
| `nova.product` | Product intent and acceptance criteria | `readonly` |

All built-ins include identity, model, prompts, runtime, tools, policy, memory placeholders, eval hooks, output contract, sub-agent compatibility, and trace attribution after resolution.
