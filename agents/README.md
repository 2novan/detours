# Agents multi-agents pour Détours

Un agent racine (`main:agent`) coordonne 4 sous-agents spécialistes :
`coder` → `reviewer` → `tester` → `ui`. Chaque spécialiste rend son rapport
au parent, qui enchaîne (relecture jusqu'à `VERDICT: OK`, tests, avis UI).

## Lancer en local

```bash
cd agents
uv sync                                   # installe mistralai-agents
export MISTRAL_API_KEY=...                # votre clé API Mistral
export ALLOW_DANGEROUS_LOCAL_HOST=1       # requis par le sandbox local (dev uniquement)
uv run python main.py                     # ou : uv run agents chat
```

En local, les agents travaillent directement sur les fichiers du dépôt
(`DangerousLocalSandbox`, sans isolation — **ne jamais utiliser ailleurs qu'en local**).

## Passer en production (sandbox Mistral Cloud + GitHub)

```bash
uv add 'mistralai-agents[koyeb]'          # support du MistralSandbox
export DETOURS_AGENT_PROD=1               # active le bloc MistralSandbox + GitHubBinding
```

Prérequis production : rôle `cloud_user` sur le workspace, connecteur GitHub
connecté pour l'utilisateur qui lance la session, dépôt autorisé :
`2novan/detours` (voir `GitHubBinding` dans `main.py`).

## Voir les interactions

`session.run(..., on_event=...)` affiche chaque événement (démarrage des
sous-agents, messages, résultats) et `session.subagents()` liste les
sessions des spécialistes lancés.
