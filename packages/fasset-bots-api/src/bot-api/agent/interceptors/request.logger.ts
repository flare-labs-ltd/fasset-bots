import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
// eslint-disable-next-line node/no-extraneous-import
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('RequestLoggerMiddleware');

  use(req: Request, res: Response, next: NextFunction) {
    this.logger.log(`${req.method} ${req.baseUrl} ${req.ip}`);
    next();
  }
}