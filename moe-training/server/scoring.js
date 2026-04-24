// FSL-1.1-Apache-2.0 — see LICENSE

export class TrajectoryScorer {
  constructor(constants) {
    this.modelTiers = constants.MODEL_TIERS || {};
    this.multipliers = constants.QUALITY_MULTIPLIERS || {};
  }

  score(stitchedTrajectory) {
    const steps = stitchedTrajectory.trajectory_log || [];
    const metadata = stitchedTrajectory.metadata || {};

    // DERIVE from actual steps — never trust client-reported outcome
    const correctionSteps = steps.filter(s => s.type === 'correction').length;
    const coordinationSteps = steps.filter(s => s.type === 'coordination').length;
    const errorSteps = steps.filter(s => s.type === 'error').length;
    const resolutionSteps = steps.filter(s => s.type === 'resolution').length;
    const errorsRecovered = Math.min(errorSteps, resolutionSteps);

    const basePoints = Math.min(steps.length, 5000);

    const modelEngine = metadata.model_engine || '';
    const modelMultiplier = this.modelTiers[modelEngine] || 1;

    // Correction bonus: 10x on ACTUAL correction steps, capped at 30% of trajectory
    const maxCorrectionSteps = Math.floor(steps.length * 0.3);
    const cappedCorrectionSteps = Math.min(correctionSteps, maxCorrectionSteps);
    const correctionBonus = cappedCorrectionSteps * (this.multipliers.correction || 10);

    // Coordination bonus: 5x on ACTUAL coordination steps, capped at 20% of trajectory
    const maxCoordSteps = Math.floor(steps.length * 0.2);
    const cappedCoordSteps = Math.min(coordinationSteps, maxCoordSteps);
    const coordinationBonus = cappedCoordSteps * (this.multipliers.coordination || 5);

    // Error recovery: 3x if errors AND resolutions exist in the trajectory
    const errorRecoveryBonus = errorsRecovered > 0 ? Math.min(errorsRecovered, errorSteps) * (this.multipliers.errorRecovery || 3) : 0;

    // Complexity bonus: only if validated value
    const validComplexity = ['light', 'medium', 'heavy'];
    const complexityBonus = validComplexity.includes(metadata.task_complexity) && metadata.task_complexity === 'heavy'
      ? basePoints * 1
      : 0;

    // Quality bonus: server-derived from trajectory completeness
    const hasResolution = resolutionSteps > 0;
    const reasonableLength = steps.length >= 5 && steps.length <= 5000;
    const subtotal = (basePoints * modelMultiplier) + correctionBonus + coordinationBonus + errorRecoveryBonus + complexityBonus;
    const qualityBonus = (hasResolution && reasonableLength) ? Math.floor(subtotal * 0.1) : 0;

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
