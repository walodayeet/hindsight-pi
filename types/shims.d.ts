declare module '@vectorize-io/hindsight-client' {
  export class HindsightClient {
    constructor(config: { baseUrl: string; apiKey?: string });
    createBank(bankId: string, body?: Record<string, unknown>): Promise<any>;
    getBankProfile(bankId: string): Promise<any>;
    retain(bankId: string, content: string, options?: Record<string, unknown>): Promise<any>;
    retainBatch(bankId: string, items: Array<Record<string, unknown>>, options?: Record<string, unknown>): Promise<any>;
    recall(bankId: string, query: string, options?: Record<string, unknown>): Promise<any>;
    reflect(bankId: string, query: string, options?: Record<string, unknown>): Promise<any>;
    createMentalModel(...args: any[]): Promise<any>;
    listMentalModels(...args: any[]): Promise<any>;
    getMentalModel(...args: any[]): Promise<any>;
    refreshMentalModel(...args: any[]): Promise<any>;
    updateMentalModel(...args: any[]): Promise<any>;
    deleteMentalModel(...args: any[]): Promise<any>;
  }
}

declare module '@mariozechner/pi-coding-agent' {
  export type ExtensionAPI = any;
  export type ExtensionContext = any;
}

declare module '@sinclair/typebox' {
  export const Type: any;
}
