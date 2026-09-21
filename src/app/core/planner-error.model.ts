export type PlannerError =
  | {
      type: 'network';
      message: string;
      raw?: string;
    }
  | {
      type: 'auth';
      message: string;
      raw?: string;
    }
  | {
      type: 'rate_limit';
      message: string;
      raw?: string;
    }
  | {
      type: 'invalid_json';
      message: string;
      raw: string;
    }
  | {
      type: 'schema_validation';
      message: string;
      fields: string[];
      raw?: string;
    }
  | {
      type: 'provider_error';
      message: string;
      finishReason?: string;
      raw?: string;
    }
  | {
      type: 'stage_failed';
      stage: 'scaffold' | 'layers' | 'domains' | 'tail' | 'merge' | 'repair';
      message: string;
      fields?: string[];
      skillId?: string;
      raw?: string;
    }
  | {
      type: 'persistence';
      message: string;
      bytes?: number;
      raw?: string;
    }
  | {
      type: 'warning';
      message: string;
    };
