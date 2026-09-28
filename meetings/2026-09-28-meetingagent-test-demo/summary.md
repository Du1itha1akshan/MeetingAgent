# Quantum Computing and Cybersecurity Discussion

**Date:** 2026-09-28T11:35:00Z

## Overview
Dulitha Lakshan and Binura Ranasinghe held a short 5-minute session on the implications of quantum computing for cybersecurity. Binura outlined the key risk of 'harvest now, decrypt later' attacks and explained defensive options including post-quantum cryptography. The team identified priority data assets and vendor readiness as immediate areas of focus, and agreed on four action items to be reviewed in a follow-up session.

## Key Points
- Quantum computers could one day break widely used encryption standards such as RSA and elliptic curve cryptography, affecting websites, VPNs, and certificates.
- The 'harvest now, decrypt later' threat means attackers can steal encrypted data today and decrypt it once quantum capability matures.
- Data identified as needing long-term protection includes customer records, contracts, and source code.
- Post-quantum cryptography (new algorithms running on normal hardware) is the most practical near-term defense; NIST released the first standards in 2024.
- Additional quantum-era defenses include quantum key distribution and quantum random number generators.
- Most post-quantum updates are expected to come through vendor/OS updates (e.g., Windows).
- A key open question is whether current vendors (cloud, VPN, certificate providers) have a post-quantum roadmap.

## Decisions
- Four action items were agreed upon to be completed before a follow-up session.

## Open Questions
- Do our key vendors (cloud, VPN, and certificate providers) have a post-quantum cryptography plan or roadmap?
- Which specific data assets in the organization need to remain secret for five years or more beyond customer records, contracts, and source code?
