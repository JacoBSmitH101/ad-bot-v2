## Overview

Discord-only darts league bot, rewritten cleanly with proper separation of concerns.
Runs as a long-lived Node.js service on a Linux VM.

No Challonge, no Autodarts API, no Discord threads (MVP).

---

## Runtime Model

-   Single VM
-   Two environments:
    -   /home/jacob/Dev
    -   /home/jacob/Prod
-   Each environment has its own .env
-   Same codebase, different configs

---

## Process Management (systemd)

The bot runs as a systemd service.

Benefits:

-   starts on boot
-   restarts on crash
-   centralised logging

Useful commands:
systemctl status league-bot-prod
systemctl restart league-bot-prod
journalctl -u league-bot-prod -f

---

## Deployment

CI/CD (Azure DevOps):

-   pull latest code
-   install deps
-   build TypeScript
-   restart systemd service

No Docker required for MVP.
