# AgentForge Workflow Orchestration Guide

AgentForge includes a durable, dependency-aware workflow engine designed specifically for coordinating multi-step procedures while leaving cognitive reasoning to **Google Antigravity**.

---

## 1. Workflow Definition Structure

A workflow definition is a structured JSON or TypeScript object defining an ordered sequence of steps:

```json
{
  "id": "git-status-and-verify",
  "name": "Git Status and Tag Verification",
  "description": "Inspects local repository status and verifies tagged releases",
  "steps": [
    {
      "id": "check-status",
      "bridge": "github",
      "action": "status-check",
      "inputs": {}
    },
    {
      "id": "inspect-repo",
      "bridge": "github",
      "action": "repo-info",
      "dependsOn": ["check-status"],
      "inputs": {}
    },
    {
      "id": "verify-release",
      "bridge": "github",
      "action": "release-verify",
      "dependsOn": ["inspect-repo"],
      "inputs": {}
    }
  ]
}
```

---

## 2. Step Input & Output Resolution

Workflows can chain outputs from completed steps into inputs for subsequent steps.

### 2.1 Direct Object References
When an entire input field receives the output of a prior step, use `$steps.<step-id>.output.<field>`. This preserves rich structured objects, arrays, and numbers without stringifying them:

```json
{
  "id": "process-channel",
  "bridge": "youtube",
  "action": "video-list",
  "inputs": {
    "playlistId": "$steps.get-channel.output.channel.uploadsPlaylistId",
    "maxResults": 10
  }
}
```

### 2.2 Inline String Templates
For string interpolation, use `{{steps.<step-id>.output.<field>}}`:

```json
{
  "id": "announce",
  "bridge": "example-echo",
  "action": "echo",
  "inputs": {
    "message": "Current branch is {{steps.check-repo.output.branch}} on commit {{steps.check-repo.output.latestCommit.shortHash}}"
  }
}
```

---

## 3. Approval Checkpoints

When a workflow step requires a permission level of `external-write`, `publish`, or `destructive`, execution halts automatically and enters the `paused_for_approval` state:

```json
{
  "runId": "run-1729170000000-xyz",
  "status": "paused_for_approval",
  "pendingApproval": {
    "approvalRequestId": "req-12345",
    "stepId": "upload-video",
    "provider": "youtube",
    "action": "video-upload",
    "permissionLevel": "publish",
    "reason": "Uploading a video publishes content to YouTube.",
    "inputs": {
      "filePath": "C:\\videos\\demo.mp4",
      "title": "Release Walkthrough"
    }
  }
}
```

### Resuming or Rejecting via API
To approve or reject a paused workflow:
```bash
# Approve checkpoint
curl -X POST http://localhost:9470/api/workflows/runs/run-1729170000000-xyz/approve \
  -H "Content-Type: application/json" \
  -d '{
    "approvalRequestId": "req-12345",
    "decision": {
      "approvedBy": "operator-hamza",
      "confirmed": true,
      "reason": "Verified video metadata and target channel"
    }
  }'
```

---

## 4. Retries and Crash Recovery

Steps can configure bounded retries for transient network errors:
```json
{
  "id": "fetch-data",
  "bridge": "github",
  "action": "repo-info",
  "retryable": true,
  "maxRetries": 3
}
```
If a transient failure occurs, the engine pauses and retries up to `maxRetries` times before transitioning to `failed`.

---

## 5. Workflow Cancellation

Active or paused workflow runs can be cancelled cleanly:
```bash
curl -X POST http://localhost:9470/api/workflows/runs/<RUN_ID>/cancel
```
The engine dispatches an `AbortSignal` to cooperative step executors, records the cancellation timestamp, and marks the run status as `cancelled`.
