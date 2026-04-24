// FSL-1.1-Apache-2.0 — see LICENSE

export class TrajectoryScorer {
  constructor(constants) {
    this.modelTiers = constants.MODEL_TIERS || {};
    this.multipliers = constants.QUALITY_MULTIPLIERS || {};
  }

  score(stitchedTrajectory) {
    const steps = stitchedTrajectory.trajectory_log || [];
    const metadata = stitchedTrajectory.metadata || {};
    const outcome = stitchedTrajectory.outcome || {};

    const basePoints = steps.length;

    const modelEngine = metadata.model_engine || '';
    const modelMultiplier = this.modelTiers[modelEngine] || 1;

    let correctionBonus = 0;
    if (outcome.user_interventions > 0) {
      const correctionSteps = steps.filter(s => s.type === 'correction').length;
      correctionBonus = correctionSteps * (this.multipliers.correction || 10);
    }

    let coordinationBonus = 0;
    if (outcome.coordination_events > 0) {
      const coordSteps = steps.filter(s => s.type === 'coordination').length;
      coordinationBonus = coordSteps * (this.multipliers.coordination || 5);
    }

    let errorRecoveryBonus = 0;
    if (outcome.errors_encountered > 0 && outcome.errors_recovered > 0) {
      const errorSteps = steps.filter(s => s.type === 'error').length;
      errorRecoveryBonus = errorSteps * (this.multipliers.errorRecovery || 3);
    }

    let complexityBonus = 0;
    if (metadata.task_complexity === 'heavy') {
      complexityBonus = basePoints * ((this.multipliers.heavyTask || 2) - 1);
    }

    let subtotal = (basePoints * modelMultiplier) + correctionBonus + coordinationBonus + errorRecoveryBonus + complexityBonus;

    let qualityBonus = 0;
    if (metadata.session_quality >= 80) {
      qualityBonus = subtotal * ((this.multipliers.highQuality || 1.5) - 1);
    }

    const totalPoints = subtotal + qualityBonus;

    return {
      basePoints,
      modelMultiplier,
      correctionBonus,
      coordinationBonus,
      errorRecoveryBonus,
      complexityBonus,
      qualityBonus,
      totalPoints,
    };
  }
}
