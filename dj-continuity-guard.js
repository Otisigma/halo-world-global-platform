(function (global) {
  "use strict";

  class HaloContinuityGuard {
    constructor(options = {}) {
      const config = options.config || {};
      this.config = {
        checkIntervalMs: 100,
        silenceThresholdDb: -48,
        maxAllowedSilenceMs: 250,
        prerollWarningWindowSec: 12,
        criticalDeadlineSec: 4.5,
        recoveryHoldMs: 400,
        ...config
      };
      this.callbacks = {
        isPlaybackExpected: options.isPlaybackExpected || (() => false),
        getLevelDb: options.getLevelDb || (() => -100),
        getBoundaryState: options.getBoundaryState || (() => null),
        onPreroll: options.onPreroll || (() => {}),
        onCriticalBoundary: options.onCriticalBoundary || (() => {}),
        startFiller: options.startFiller || (() => {}),
        stopFiller: options.stopFiller || (() => {}),
        onStatusChange: options.onStatusChange || (() => {}),
        onTelemetry: options.onTelemetry || null
      };
      this.watchdogTimer = 0;
      this.silentDurationMs = 0;
      this.recoveryDurationMs = 0;
      this.fillerActive = false;
      this.recoveryCount = 0;
      this.lastLevelDb = -100;
      this.lastPrerollCycleKey = "";
      this.lastCriticalCycleKey = "";
      this.fillerEngagedThisTick = false;
      this.status = { state: "idle", message: "Continuity guard standing by.", fillerActive: false, recoveries: 0 };
    }

    init() {
      this.setStatus("idle", "Continuity guard standing by.");
      this.startWatchdog();
      return this;
    }

    setStatus(state, message, detail = {}) {
      const next = {
        state,
        message,
        fillerActive: this.fillerActive,
        recoveries: this.recoveryCount,
        silentDurationMs: this.silentDurationMs,
        levelDb: this.lastLevelDb,
        ...detail
      };
      const changed = this.status.state !== next.state
        || this.status.message !== next.message
        || this.status.fillerActive !== next.fillerActive
        || this.status.silentDurationMs !== next.silentDurationMs
        || this.status.levelDb !== next.levelDb;
      this.status = next;
      if (changed) this.callbacks.onStatusChange(next);
    }

    notifyTelemetry(event, details = {}) {
      const payload = {
        event,
        ...details,
        state: this.status.state,
        fillerActive: this.fillerActive,
        recoveries: this.recoveryCount
      };
      if (typeof this.callbacks.onTelemetry === "function") {
        this.callbacks.onTelemetry(payload);
        return;
      }
      global.haloStats?.track?.(`continuity_${event}`, payload);
    }

    engageFiller(reason, detail = {}) {
      if (this.fillerActive) return;
      this.fillerEngagedThisTick = true;
      this.fillerActive = true;
      this.recoveryCount += 1;
      this.recoveryDurationMs = 0;
      this.callbacks.startFiller({ reason, ...detail });
      this.notifyTelemetry("filler_engaged", { reason, ...detail });
      this.setStatus("bridge-active", "Continuity guard active. Audible bridge engaged.", { reason, ...detail });
    }

    releaseFiller(reason, detail = {}) {
      if (!this.fillerActive) return;
      this.callbacks.stopFiller({ reason, ...detail });
      this.fillerActive = false;
      this.notifyTelemetry("filler_released", { reason, ...detail });
      this.setStatus("normal", "Continuity guard locked. Audio recovered.", { reason, ...detail });
    }

    checkPredictiveBoundary() {
      const boundary = this.callbacks.getBoundaryState();
      const remainingSec = Number(boundary?.remainingSec);
      if (!Number.isFinite(remainingSec) || remainingSec <= 0) {
        this.lastPrerollCycleKey = "";
        this.lastCriticalCycleKey = "";
        return;
      }
      const cycleKey = `${boundary.activeDeckId || boundary.activeId || "active"}:${boundary.incomingDeckId || boundary.incomingId || "incoming"}`;
      if (remainingSec <= this.config.prerollWarningWindowSec && remainingSec > this.config.criticalDeadlineSec && this.lastPrerollCycleKey !== cycleKey) {
        this.lastPrerollCycleKey = cycleKey;
        this.callbacks.onPreroll(boundary);
        this.notifyTelemetry("preroll_started", { remainingSec, ...boundary });
        this.setStatus("pre-roll", `Predictive pre-roll armed with ${remainingSec.toFixed(1)}s remaining.`, boundary);
      }
      if (remainingSec <= this.config.criticalDeadlineSec && remainingSec > 0 && !boundary.incomingReady && this.lastCriticalCycleKey !== cycleKey) {
        this.lastCriticalCycleKey = cycleKey;
        this.callbacks.onCriticalBoundary(boundary);
        this.engageFiller("critical_boundary", { remainingSec, ...boundary });
      }
      if (remainingSec > this.config.prerollWarningWindowSec) {
        this.lastPrerollCycleKey = "";
        this.lastCriticalCycleKey = "";
      }
    }

    tick() {
      this.fillerEngagedThisTick = false;
      const playbackExpected = Boolean(this.callbacks.isPlaybackExpected());
      if (!playbackExpected) {
        this.silentDurationMs = 0;
        this.recoveryDurationMs = 0;
        this.lastPrerollCycleKey = "";
        this.lastCriticalCycleKey = "";
        if (this.fillerActive) this.releaseFiller("playback_paused");
        this.setStatus("idle", "Continuity guard standing by.");
        return;
      }

      this.checkPredictiveBoundary();
      if (this.fillerEngagedThisTick) return;
      const nextLevel = Number(this.callbacks.getLevelDb());
      this.lastLevelDb = Number.isFinite(nextLevel) ? nextLevel : -100;

      if (this.lastLevelDb < this.config.silenceThresholdDb) {
        this.silentDurationMs += this.config.checkIntervalMs;
        this.recoveryDurationMs = 0;
        if (!this.fillerActive && this.silentDurationMs >= this.config.maxAllowedSilenceMs) {
          this.engageFiller("silence_watchdog", {
            levelDb: this.lastLevelDb,
            silentDurationMs: this.silentDurationMs
          });
          return;
        }
        if (!this.fillerActive) {
          this.setStatus("watching", `Continuity guard watching ${this.silentDurationMs}ms of low signal.`, {
            silentDurationMs: this.silentDurationMs
          });
        }
        return;
      }

      this.recoveryDurationMs += this.config.checkIntervalMs;
      this.silentDurationMs = 0;
      if (this.fillerActive && this.recoveryDurationMs >= this.config.recoveryHoldMs) {
        this.releaseFiller("audio_recovered", { levelDb: this.lastLevelDb });
        return;
      }
      if (this.status.state !== "pre-roll") this.setStatus("normal", "Continuity guard locked. No silence exposed.");
    }

    startWatchdog() {
      this.stopWatchdog();
      this.watchdogTimer = global.setInterval(() => this.tick(), this.config.checkIntervalMs);
    }

    stopWatchdog() {
      if (!this.watchdogTimer) return;
      global.clearInterval(this.watchdogTimer);
      this.watchdogTimer = 0;
    }

    destroy() {
      this.stopWatchdog();
      if (this.fillerActive) this.callbacks.stopFiller({ reason: "destroy" });
      this.fillerActive = false;
      this.setStatus("idle", "Continuity guard offline.");
    }
  }

  global.HaloContinuityGuard = HaloContinuityGuard;
  global.HaloDjContinuityGuard = HaloContinuityGuard;
})(typeof window !== "undefined" ? window : globalThis);
