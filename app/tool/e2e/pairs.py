#!/usr/bin/env python3
"""How many runs the journey needs, and which ones.

Two lists have to be covered: the client sides we ship, and the environments a customer's machine
can be in (today that is only how Claude Code got installed). Every entry in each list has to appear
at least once, and the total should be as small as that allows — which is max(len(clients),
len(environments)) runs, not len(clients) * len(environments), and certainly not one run per half.

So the two lists are paired offset against each other, repeating the shorter one:

    clients      = [web, android]
    environments = [npm:2.1.220, installer]
    ->  web+npm:2.1.220, android+installer                    (two runs, everything covered)

Written as a function rather than typed into the workflow because adding a client or an environment
should be one line in a list, not a hand-recomputed matrix that quietly stops covering something.

    python3 pairs.py            # the pairs, one per line, for a human
    python3 pairs.py --json     # a matrix for GitHub Actions
"""

import argparse
import json

# The client sides this suite can drive today.
# `android` is the installed client, driven on an emulator: the same journey, on a device where
# the tab bar is hidden inside a conversation and a document is the whole screen. It found three
# assumptions the web leg could not, because a wide window makes all three true.
CLIENTS = ["web", "android"]

# What plays the agent's program on the machine, same meaning as in .github/scripts/e2e.sh. Both are
# the real Claude Code: the pinned one is where determinism comes from — nothing about it can change
# without somebody changing the number.
ENVIRONMENTS = ["npm:2.1.220", "installer"]


def pairs(clients=None, environments=None):
    """Every client and every environment covered, in max(len, len) runs."""
    clients = clients or CLIENTS
    environments = environments or ENVIRONMENTS
    if not clients or not environments:
        return []
    runs = max(len(clients), len(environments))
    return [
        {"client": clients[i % len(clients)], "leg": environments[i % len(environments)]}
        for i in range(runs)
    ]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="print a GitHub Actions matrix")
    args = ap.parse_args()
    made = pairs()
    if args.json:
        print(json.dumps({"include": made}))
    else:
        for run in made:
            print(f"{run['client']} + {run['leg']}")
