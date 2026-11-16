"""Orchestrateur multi-agents Mistral pour le projet Détours.

Un agent racine coordonne 4 spécialistes qui interagissent entre eux :
    coder -> reviewer -> testeur -> ui

Lancement :
    uv run python main.py        # exécution directe
    uv run agents chat           # via le CLI du Agents SDK (entrypoint = main:agent)

Pré-requis : MISTRAL_API_KEY dans l'environnement.
En local, le bac à sable dangereux exige : ALLOW_DANGEROUS_LOCAL_HOST=1
"""

import asyncio
import os

from mistralai import agents

# ── Les 4 spécialistes ───────────────────────────────────────────────

coder = agents.Subagent(
    name="coder",
    description="Écrit le code JavaScript/Node du projet Détours à partir d'une spécification.",
    instructions=(
        "Tu es un développeur JavaScript expérimenté sur le projet Détours "
        "(moteur de routage en JS pur dans src/, PWA dans public/, tests avec `node --test`). "
        "Tu écris du code propre, commenté et cohérent avec le style existant. "
        "Tu réponds avec le code complet, jamais un diff. "
        "Quand on te demande des corrections, tu retournes le fichier entier corrigé."
    ),
)

reviewer = agents.Subagent(
    name="reviewer",
    description="Relit le code et répond exactement VERDICT: OK, ou une liste de problèmes classés par sévérité.",
    instructions=(
        "Tu es un relecteur de code strict. Tu ne corriges PAS le code toi-même. "
        "Tu retournes une liste de problèmes classés par sévérité (critique / majeur / mineur), "
        "avec pour chacun la ligne concernée, le problème et la correction suggérée. "
        "Si le code est acceptable, réponds exactement : VERDICT: OK"
    ),
)

tester = agents.Subagent(
    name="tester",
    description="Écrit et exécute les tests du projet (node --test) sur le code fourni.",
    instructions=(
        "Tu es un ingénieur QA sur le projet Détours. "
        "Tu écris des tests dans test/ couvrant cas nominaux, cas limites et entrées invalides, "
        "puis tu les exécutes avec `node --test` et tu rapportes le résultat exact (succès/échec, nombre de tests)."
    ),
)

ui = agents.Subagent(
    name="ui",
    description="Spécialiste UI/UX de la PWA (public/) : accessibilité, hiérarchie visuelle, responsive, cohérence.",
    instructions=(
        "Tu es un spécialiste UI/UX. Tu évalues l'interface : hiérarchie visuelle, accessibilité "
        "(contraste, tailles, ARIA), responsive, cohérence des composants, performance perçue. "
        "Tu réponds par une liste à puces d'améliorations concrètes et priorisées."
    ),
)

# ── L'agent racine ───────────────────────────────────────────────────
# ⭐ C'est ICI que se branche l'environnement d'exécution (environment=).
# Les sous-agents héritent automatiquement du même sandbox.

_USE_PRODUCTION_SANDBOX = os.environ.get("DETOURS_AGENT_PROD", "") == "1"

if _USE_PRODUCTION_SANDBOX:
    # Production (déployé) : container Mistral Cloud + accès GitHub limité au dépôt.
    # Nécessite : uv add 'mistralai-agents[koyeb]', le rôle cloud_user,
    # et un connecteur GitHub pour l'utilisateur qui lance la session.
    environment = agents.MistralSandbox(
        network=agents.Network.all(),
        header_bindings=(
            agents.GitHubBinding(repos=("2novan/detours",)),
        ),
    )
else:
    # Développement local : les agents travaillent directement sur votre machine.
    # ⚠️ Nécessite ALLOW_DANGEROUS_LOCAL_HOST=1 — ne jamais utiliser hors local.
    environment = agents.DangerousLocalSandbox()

agent = agents.Agent(
    name="detours-orchestrateur",
    model="mistral-large-latest",
    instructions=(
        "Tu coordonnes une équipe de spécialistes pour faire évoluer le projet Détours "
        "(application d'itinéraires touristiques en JavaScript/Node, voir README.md). "
        "Procédure : "
        "1) Demande au subagent 'coder' d'écrire le code demandé. "
        "2) Envoie ce code au subagent 'reviewer' ; si la réponse n'est pas VERDICT: OK, "
        "renvoie le code au coder avec les remarques (3 itérations maximum). "
        "3) Demande au subagent 'tester' d'écrire et d'exécuter les tests ; "
        "en cas d'échec, renvoie au coder avec le rapport d'échec. "
        "4) Si le livrable touche à l'interface (public/), demande l'avis du subagent 'ui'. "
        "Attends toujours le rapport de chaque subagent avant de passer à l'étape suivante. "
        "Termine par le code final et le résumé des tests."
    ),
    environment=environment,
    subagents=[coder, reviewer, tester, ui],
)


async def main() -> None:
    task = (
        "Dans le projet Détours (répertoire courant), ajoute une fonction "
        "`formatDistance(meters)` dans src/geo.js qui formate une distance "
        "(ex. 950 -> '950 m', 1500 -> '1,5 km'), avec relecture et tests."
    )
    session = await agent.start_session()

    def log(e) -> None:
        """Log lisible : on n'affiche que les appels d'outils et les rapports des sous-agents."""
        name = type(e).__name__
        if name in ("Notice", "TextDelta", "SessionUpdated", "TurnUpdated", "TurnStarted"):
            return
        if name in ("EntryAdded", "EntryCompleted"):
            entry = getattr(e, "entry", None)
            kind = type(entry).__name__ if entry is not None else ""
            if kind == "ToolCallEntry":
                print(f"\n🔧 {getattr(entry, 'name', '?')} {getattr(entry, 'arguments', {})}")
            elif kind == "UnknownEntry":
                raw = getattr(entry, "raw", {}) or {}
                if raw.get("type") == "message" and raw.get("kind") == "result":
                    src = raw.get("source", {}).get("agentPath", "sous-agent")
                    out = raw.get("termination", {}).get("output", [])
                    text = "".join(o.get("text", "") for o in out if isinstance(o, dict))
                    print(f"\n📨 Rapport de {src} :\n{text[:800]}")
            return
        print(e)

    state = await session.run(task, on_event=log)
    if isinstance(state, agents.Completed):
        print("\n=== RAPPORT FINAL ===\n", state.text)
    print("Sous-agents lancés :", len(await session.subagents()))
    await session.cancel()


if __name__ == "__main__":
    asyncio.run(main())
