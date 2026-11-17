## ADDED Requirements

### Requirement: The browser build has a plain status page
The repository SHALL contain `docs/STATUS.md` with four sections: Run it, Works, Missing or different from desktop, Checks. Every line under Works SHALL name a smoke command that passes.

#### Scenario: Wojtek reads the status page
- **WHEN** Wojtek opens `docs/STATUS.md`
- **THEN** he finds the commands to run the page, the features that work with their checks, and what is still missing

#### Scenario: A listed feature breaks
- **WHEN** the smoke command of a line under Works fails
- **THEN** that line moves to "Missing or different from desktop"
