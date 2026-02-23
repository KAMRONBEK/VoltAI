import axios, { type AxiosInstance } from "axios";

interface NumberResponse {
  activationId: string;
  phoneNumber: string;
}

export class GrizzlySmsClient {
  private readonly apiKey: string;
  private readonly http: AxiosInstance;

  constructor(apiKey = process.env.GRIZZLYSMS_API_KEY ?? "") {
    if (!apiKey) {
      throw new Error("GRIZZLYSMS_API_KEY is required");
    }
    this.apiKey = apiKey;
    this.http = axios.create({
      baseURL: "https://api.grizzlysms.com/stubs/handler_api.php",
      timeout: 30_000
    });
  }

  async getBalance(): Promise<number> {
    const response = await this.request({
      action: "getBalance"
    });

    if (!response.startsWith("ACCESS_BALANCE:")) {
      throw new Error(`Unexpected getBalance response: ${response}`);
    }
    return Number(response.replace("ACCESS_BALANCE:", ""));
  }

  async getNumber(service: string, country: string): Promise<NumberResponse> {
    const response = await this.request({
      action: "getNumberV2",
      service,
      country
    });

    try {
      const parsed = JSON.parse(response) as {
        activationId: number | string;
        phoneNumber: string;
      };
      return {
        activationId: String(parsed.activationId),
        phoneNumber: parsed.phoneNumber
      };
    } catch {
      if (response.startsWith("ACCESS_NUMBER:")) {
        const [, activationId, phoneNumber] = response.split(":");
        return { activationId, phoneNumber };
      }
      throw new Error(`Unexpected getNumber response: ${response}`);
    }
  }

  async waitForCode(activationId: string, timeoutMs = 120_000): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await this.request({
        action: "getStatus",
        id: activationId
      });

      if (response.startsWith("STATUS_OK:")) {
        return response.replace("STATUS_OK:", "").trim();
      }

      if (response === "STATUS_CANCEL") {
        throw new Error(`Activation cancelled: ${activationId}`);
      }

      await delay(3000);
    }

    throw new Error(`OTP timeout for activation ${activationId}`);
  }

  async setStatus(activationId: string, status: -1 | 1 | 3 | 6 | 8): Promise<void> {
    await this.request({
      action: "setStatus",
      id: activationId,
      status: String(status)
    });
  }

  private async request(params: Record<string, string>): Promise<string> {
    const response = await this.http.get<string>("", {
      params: { api_key: this.apiKey, ...params },
      responseType: "text",
      transformResponse: [(value) => value]
    });

    const text = String(response.data).trim();
    if (text.startsWith("BAD_") || text === "NO_ACTIVATION" || text === "NO_NUMBERS") {
      throw new Error(`GrizzlySMS API error: ${text}`);
    }
    return text;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
