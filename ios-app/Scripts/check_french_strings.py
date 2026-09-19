#!/usr/bin/env python3
"""Garde-fou CI : refuse les chaines francaises visibles sans accents.

L'app est en francais (developmentLanguage: fr). Un « Itineraire en cours »
passe la compilation, passe la revue, et s'affiche pendant toute une
simulation — c'est exactement ce qui s'est produit dans
BottomSheetActiveRouteControlsView.swift (cf. docs/UI_UX_AUDIT_IOS_2026-09.md,
P0-2). Ce script relit les litteraux de chaine et signale les mots connus dont
il manque l'accent.

    python3 ios-app/Scripts/check_french_strings.py

Sortie non nulle = au moins une occurrence trouvee.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCANNED = [ROOT / "Sources", ROOT / "Widgets"]

# Mot sans accent -> forme attendue. Compare en minuscules, sur des mots
# entiers uniquement (donc « arret » n'attrape pas « arretez » : ajoutez la
# forme si elle apparait un jour).
EXPECTED = {
    "itineraire": "itinéraire",
    "itineraires": "itinéraires",
    "duree": "durée",
    "durees": "durées",
    "arret": "arrêt",
    "arrets": "arrêts",
    "arreter": "arrêter",
    "etape": "étape",
    "etapes": "étapes",
    "details": "détails",
    "detail": "détail",
    "reglages": "réglages",
    "deplacement": "déplacement",
    "deconnecte": "déconnecté",
    "deconnexion": "déconnexion",
    "derive": "dérive",
    "decouverte": "découverte",
    "precision": "précision",
    "reessayer": "réessayer",
    "apres": "après",
    "donnees": "données",
    "parametres": "paramètres",
    "verifier": "vérifier",
    "generer": "générer",
    "reussi": "réussi",
    "echec": "échec",
    "simulee": "simulée",
    "activee": "activée",
    "desactivee": "désactivée",
    "reinjection": "réinjection",
}

# Naif a dessein : un litteral par paire de guillemets sur une meme ligne.
# Les chaines multilignes et les guillemets echappes sont rares ici, et rater
# un cas est preferable a un faux positif qui casserait la CI.
STRING_LITERAL = re.compile(r'"([^"\n]*)"')
# Les interpolations \(engine.detail) portent des identifiants Swift, pas du
# texte affiche — les retirer avant de chercher des mots francais.
INTERPOLATION = re.compile(r"\\\([^()]*\)")
WORD = re.compile(r"[A-Za-zÀ-ÿ]+")


def is_identifier_like(literal: str) -> bool:
    """Ecarte les noms de symboles SF, cles UserDefaults, types UT et cles JSON."""
    return " " not in literal and ("." in literal or "_" in literal or literal.isupper())


def scan(path: Path) -> list[str]:
    problems: list[str] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        for match in STRING_LITERAL.finditer(line):
            literal = match.group(1)
            if is_identifier_like(literal):
                continue
            for word in WORD.findall(INTERPOLATION.sub(" ", literal)):
                expected = EXPECTED.get(word.lower())
                if expected:
                    problems.append(
                        f"{path.relative_to(ROOT.parent)}:{number}: "
                        f"« {word} » devrait s'ecrire « {expected} » — {literal[:70]}"
                    )
    return problems


def main() -> int:
    problems: list[str] = []
    for root in SCANNED:
        for swift in sorted(root.rglob("*.swift")):
            problems.extend(scan(swift))

    if problems:
        print("Chaines francaises sans accent :\n")
        for problem in problems:
            print(f"  {problem}")
        print(
            f"\n{len(problems)} occurrence(s). Corrigez-les, "
            f"ou completez EXPECTED dans {Path(__file__).name}."
        )
        return 1

    print("OK - aucune chaine francaise sans accent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
