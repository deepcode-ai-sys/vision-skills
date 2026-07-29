/** Custom error classes for Vision Skills. */

export class VisionSkillsError extends Error {
  constructor(
    message: string,
    public code: string = 'INTERNAL_ERROR',
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'VisionSkillsError';
  }
}

export class ValidationError extends VisionSkillsError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class ProviderError extends VisionSkillsError {
  constructor(
    message: string,
    public provider: string,
    public originalError?: Error,
  ) {
    super(message, 'PROVIDER_ERROR', 502);
    this.name = 'ProviderError';
  }
}

export class AllProvidersFailedError extends VisionSkillsError {
  constructor(
    public pluginType: string,
    details?: unknown,
  ) {
    super(`All providers of type '${pluginType}' failed`, 'ALL_PROVIDERS_FAILED', 502, details);
    this.name = 'AllProvidersFailedError';
  }
}

export class RateLimitError extends VisionSkillsError {
  constructor(
    message = 'Rate limit exceeded',
    public retryAfter = 60,
  ) {
    super(message, 'RATE_LIMIT_ERROR', 429);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends VisionSkillsError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class ConfigurationError extends VisionSkillsError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}
