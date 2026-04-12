#!/bin/bash
# parallel-claude.sh — Spawn Claude Code instances in separate Ghostty terminals
# Each instance gets its own full context window and works independently.
#
# Usage:
#   ./scripts/parallel-claude.sh "task1 prompt" "task2 prompt" ...
#
# Results are written to /tmp/claude-parallel/<session-id>/task-N.md
# Main terminal can monitor progress via: watch ls -la /tmp/claude-parallel/<session-id>/

set -euo pipefail

SESSION_ID="$(date +%Y%m%d-%H%M%S)-$$"
RESULTS_DIR="/tmp/claude-parallel/${SESSION_ID}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS=("$@")

if [ ${#TASKS[@]} -eq 0 ]; then
  echo "Usage: $0 \"task1 prompt\" \"task2 prompt\" ..."
  echo ""
  echo "Example:"
  echo "  $0 \\"
  echo "    \"Review backend/api/routes_ai.py for security issues\" \\"
  echo "    \"Add unit tests for backend/ai/deck_builder.py\""
  exit 1
fi

mkdir -p "$RESULTS_DIR"

echo "═══════════════════════════════════════════════════"
echo "  Parallel Claude — Session: ${SESSION_ID}"
echo "  Tasks: ${#TASKS[@]}"
echo "  Results: ${RESULTS_DIR}"
echo "═══════════════════════════════════════════════════"

PIDS=()

for i in "${!TASKS[@]}"; do
  TASK_NUM=$((i + 1))
  TASK_PROMPT="${TASKS[$i]}"
  RESULT_FILE="${RESULTS_DIR}/task-${TASK_NUM}.md"
  STATUS_FILE="${RESULTS_DIR}/task-${TASK_NUM}.status"
  TASK_NAME="Task-${TASK_NUM}"

  echo ""
  echo "▸ Spawning ${TASK_NAME}: ${TASK_PROMPT:0:80}..."

  # Write status file
  echo "running" > "$STATUS_FILE"

  # Build the wrapper script that runs in the new terminal
  WRAPPER="/tmp/claude-parallel-wrapper-${SESSION_ID}-${TASK_NUM}.sh"
  cat > "$WRAPPER" << WRAPPER_EOF
#!/bin/bash
cd "${PROJECT_DIR}"

echo "════════════════════════════════════════"
echo "  ${TASK_NAME} — Starting..."
echo "  Prompt: ${TASK_PROMPT:0:120}"
echo "════════════════════════════════════════"
echo ""

# Run Claude in print mode with output
claude -p "${TASK_PROMPT}" \\
  --output-format text \\
  --permission-mode default \\
  > "${RESULT_FILE}" 2>&1

EXIT_CODE=\$?

if [ \$EXIT_CODE -eq 0 ]; then
  echo "done" > "${STATUS_FILE}"
  echo ""
  echo "════════════════════════════════════════"
  echo "  ✓ ${TASK_NAME} completed successfully"
  echo "  Result: ${RESULT_FILE}"
  echo "════════════════════════════════════════"
else
  echo "failed" > "${STATUS_FILE}"
  echo ""
  echo "════════════════════════════════════════"
  echo "  ✗ ${TASK_NAME} failed (exit code: \$EXIT_CODE)"
  echo "════════════════════════════════════════"
fi

# Keep terminal open briefly so user can see result
sleep 3
WRAPPER_EOF
  chmod +x "$WRAPPER"

  # Open in new Ghostty terminal
  open -a Ghostty "$WRAPPER"

  # Small delay to avoid race conditions
  sleep 0.5
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  All ${#TASKS[@]} tasks spawned!"
echo ""
echo "  Monitor progress:"
echo "    watch -n 2 'for f in ${RESULTS_DIR}/task-*.status; do echo \"\$(basename \$f): \$(cat \$f)\"; done'"
echo ""
echo "  Read results:"
echo "    cat ${RESULTS_DIR}/task-1.md"
echo "═══════════════════════════════════════════════════"

# Wait for all tasks to complete
echo ""
echo "Waiting for all tasks to finish..."

while true; do
  ALL_DONE=true
  for i in "${!TASKS[@]}"; do
    TASK_NUM=$((i + 1))
    STATUS_FILE="${RESULTS_DIR}/task-${TASK_NUM}.status"
    STATUS=$(cat "$STATUS_FILE" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "running" ]; then
      ALL_DONE=false
    fi
  done

  if $ALL_DONE; then
    break
  fi
  sleep 2
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  All tasks completed! Results:"
echo "═══════════════════════════════════════════════════"

for i in "${!TASKS[@]}"; do
  TASK_NUM=$((i + 1))
  STATUS=$(cat "${RESULTS_DIR}/task-${TASK_NUM}.status" 2>/dev/null || echo "unknown")
  SIZE=$(wc -c < "${RESULTS_DIR}/task-${TASK_NUM}.md" 2>/dev/null || echo "0")
  echo "  Task ${TASK_NUM}: ${STATUS} (${SIZE} bytes)"
done
