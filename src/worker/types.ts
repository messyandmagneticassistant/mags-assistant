export interface Env {
  ENABLE_SOCIAL_POSTING?: boolean;
  BRAIN: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  [key: string]: any;
}
