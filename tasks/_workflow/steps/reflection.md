# Reflection

## Purpose

Capture lessons learned and keep all knowledge bases current. This ensures:
- Future sessions benefit from discoveries made during this task
- Project documentation stays accurate and useful
- Tribal knowledge becomes documented knowledge

## When Needed

- New architectural pattern was established
- Common issue was discovered (and solved)
- Workflow improvement was identified
- Project documentation is now outdated due to changes
- Hard-won knowledge should be preserved for future reference

## When to Skip

- Trivial changes with no new insights
- All documentation is already current
- No patterns or lessons worth preserving

## Process

### 1. Update CLAUDE.md (Global/Project Instructions)

Review what belongs in CLAUDE.md:

**Add:**
- How things work (architecture, patterns)
- How to run/build/test (if changed)
- Common pitfalls and their fixes
- New conventions or standards established

**Don't add:**
- Task-specific details (stays in task files)
- Temporary workarounds
- Information that will quickly become stale

**How to update:**
- Keep it small and focused
- Replace outdated info rather than accumulating
- Group related information together

### 2. Update In-Project Documentation

This is critical for keeping the knowledge base current. Check and update:

**README.md:**
- Does it reflect current setup instructions?
- Are all features documented?
- Are examples still accurate?

**API Documentation:**
- New endpoints documented?
- Changed parameters updated?
- Response formats current?

**Architecture Docs:**
- Component diagrams still accurate?
- Data flow descriptions current?
- Integration points documented?

**Developer Guides:**
- Setup instructions still work?
- Development workflow current?
- Troubleshooting guides updated?

**Code Comments:**
- Complex logic explained?
- "Why" documented for non-obvious decisions?
- Outdated comments removed?

### 3. Knowledge Preservation Checklist

Ask yourself:
- [ ] If I start a new session tomorrow, will I have all the context I need?
- [ ] If another developer joins, can they understand the system from docs?
- [ ] Are there any "gotchas" I discovered that should be documented?
- [ ] Did I find information that was hard to discover? Document it!
- [ ] Are there dependencies or setup steps that aren't written down?

### 4. Documentation Quality Check

Good documentation is:
- **Accurate** - Reflects current state, not historical
- **Discoverable** - In expected locations with clear names
- **Concise** - Says what's needed, no more
- **Maintained** - Updated when things change (like now!)

## Output

Add a "## Reflection" section to the task file noting:
- What was updated in CLAUDE.md (if anything)
- What project documentation was updated
- Key lessons learned
- Any follow-up documentation tasks created

Example:
```markdown
## Reflection

**CLAUDE.md updates:**
- Added database connection pooling pattern
- Updated test running instructions

**Project docs updated:**
- README.md: Added new environment variables section
- docs/api.md: Documented new /users endpoint
- src/auth/README.md: Added authentication flow diagram

**Lessons learned:**
- Redis connection requires explicit timeout configuration
- Test database must be reset between integration test suites
```

## Remember

Documentation debt compounds faster than technical debt. A few minutes updating docs now saves hours of confusion later. If you learned something valuable during this task, **write it down**.
