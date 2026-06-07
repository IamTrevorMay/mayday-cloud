# Mayday Cloud — Planning

**Last updated:** 2026-06-07

---

## Current State

All stabilization phases (1–7) are complete. The platform is stable with:

- Full test coverage (unit, smoke, e2e via Playwright)
- CI/CD pipeline on GitHub Actions
- Structured logging and observability
- Weekly and monthly automated maintenance checks
- Pre-push hooks for local validation

### Recent Fixes

- Hidden files (dotfiles) filtered from Drive listing at all directory levels
- User creation and folder restriction endpoints for Studio integration
- TUS uploads excluded from global rate limiter
- Password reset flow (self-service + admin-triggered)

---

## Open Items

- [ ] Auth middleware drop-path check is fragile — coupling between mount ordering and path check should be documented

---

## Planned Work

### Near-term

<!-- Add upcoming features and priorities here -->

### Medium-term

<!-- Add medium-horizon goals here -->

### Long-term

<!-- Add long-term vision items here -->

---

## Architecture Decisions

| Date | Decision | Context |
|------|----------|---------|
| 2026-04-11 | Stabilization audit and phased roadmap | Addressed all critical/high/medium findings |
| 2026-04-12 | CORS origin allow-list | Replaced wildcard CORS with env-configurable origins |
| 2026-04-12 | Anon key for user auth | Service role reserved for admin ops only |

---

## Notes

- Web deploys manually via `npx vercel --prod` (no auto-deploy)
- API deploys via `pm2 restart mayday-api`
- Desktop releases via `desktop-v*` git tags → GitHub Actions
- See [STATUS.md](./STATUS.md) for the full audit history and completed roadmap
