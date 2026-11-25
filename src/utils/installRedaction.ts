// Side-effect module: import it FIRST in the entry point. ESM evaluates imports
// in order before the importing module's body, so installing redaction here
// (rather than in index.ts's body) also covers logs emitted while the other
// modules load.
import { installLogRedaction } from './redact.js';

installLogRedaction();
