import { Injectable, NestInterceptor, ExecutionContext, CallHandler, HttpException, HttpStatus } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResStatusEnum, ApiResponseWrapper} from "../../common/ApiResponse";

@Injectable()
export class ErrorStatusInterceptor<T> implements NestInterceptor<T, ApiResponseWrapper<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponseWrapper<T>> {
    return next.handle().pipe(
      map(data => {
        if (data && data.status === ApiResStatusEnum.ERROR) {
          throw new HttpException(data.errorMessage || 'Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
      }),
    );
  }
}
