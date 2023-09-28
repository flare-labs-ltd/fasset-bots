import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum ApiResStatusEnum {
  OK = "OK",
  ERROR = "ERROR",
}

export class ApiValidationErrorDetails {
  @ApiPropertyOptional()
  className?: string;

  @ApiPropertyOptional()
  fieldErrors?: { [key: string]: string };
}

export class ApiResponseWrapper<T> {
  data?: T;

  /**
   * Simple message to explain client developers the reason for error.
   */
  @ApiPropertyOptional()
  errorMessage?: string;

  /**
   * Response status. OK for successful responses.
   */
  @ApiProperty({ enum: ApiResStatusEnum })
  status: ApiResStatusEnum;

  @ApiPropertyOptional()
  validationErrorDetails?: ApiValidationErrorDetails;

  constructor(data: T, status?: ApiResStatusEnum, errorMessage?: string) {
    this.status = status || ApiResStatusEnum.OK;
    this.data = data;
    this.errorMessage = errorMessage;
  }
}

/**
 * Intercepts response and wraps it in ApiResponseWrapper. If exception is thrown it is logged and
 * ApiResponseWrapper with status ERROR is returned.
 * If sanitize is true, the error message is sanitized.
 * @param action
 * @param logger
 * @returns
 */
export async function handleApiResponse<T>(action: Promise<T>, sanitize = true): Promise<ApiResponseWrapper<T>> {
  try {
    const resp = await action;
    return new ApiResponseWrapper<T>(resp);
  } catch (reason) {
    if (sanitize) {
      const message = reason instanceof Error && reason.message ? reason.message : "Error while processing request";
      return new ApiResponseWrapper<T>(undefined as any, ApiResStatusEnum.ERROR, message);
    }
    return new ApiResponseWrapper<T>(undefined as any, ApiResStatusEnum.ERROR, "" + reason);
  }
}
