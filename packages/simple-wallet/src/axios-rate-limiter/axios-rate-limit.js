// Adopted from: https://github.com/aishek/axios-rate-limit
// eslint-disable-next-line @typescript-eslint/no-var-requires, no-undef
const axiosRetry = require("axios-retry");

function AxiosRateLimit(axios) {
   this.queue = [];
   this.timeslotRequests = 0;

   this.interceptors = {
      request: null,
      response: null,
   };
   this.inProcessing = 0;
   this.requestCounter = 0;
   this.reqsPs = 0;
   this.retriesPs = 0;
   this.retriesCounter = 0;
   this.handleRequest = this.handleRequest.bind(this);
   this.handleResponse = this.handleResponse.bind(this);
   this.onSend = undefined;
   this.onResponse = undefined;
   this.onQueueEmpty = undefined;
   this.onLimitReached = undefined;
   this.onPush = undefined;
   this.onRetry = undefined;
   this.onRpsSample = undefined;
   this.enable(axios);
}

AxiosRateLimit.prototype.getMaxRPS = function () {
   var perSeconds = this.perMilliseconds / 1000;
   return this.maxRequests / perSeconds;
};

AxiosRateLimit.prototype.setMaxRPS = function (rps) {
   this.setRateLimitOptions({
      maxRequests: rps,
      perMilliseconds: 1000,
   });
};

AxiosRateLimit.prototype.setRateLimitOptions = function (options) {
   if (options.maxRPS) {
      this.setMaxRPS(options.maxRPS);
   } else {
      this.perMilliseconds = options.perMilliseconds;
      this.maxRequests = options.maxRequests;
   }
   this.onSend = options.onSend;
   this.onResponse = options.onResponse;
   this.onQueueEmpty = options.onQueueEmpty;
   this.onLimitReached = options.onLimitReached;
   this.onPush = options.onPush;
   this.onRetry = options.onRetry;
   this.onRpsSample = options.onRpsSample;
   if (this.onRpsSample) {
      setInterval(() => {
         // builtin req/s meter
         this.reqsPs = this.requestCounter;
         this.requestCounter = 0;
         this.retriesPs = this.retriesCounter;
         this.retriesCounter = 0;
         this.onRpsSample(this.inProcessing, this.queue.length, this.reqsPs, this.retriesPs);
      }, 1000);
   }
};

AxiosRateLimit.prototype.enable = function (axios) {
   function handleError(error) {
      return Promise.reject(error);
   }

   this.interceptors.request = axios.interceptors.request.use(this.handleRequest, handleError);
   this.interceptors.response = axios.interceptors.response.use(this.handleResponse, handleError);
};

AxiosRateLimit.prototype.handleRequest = function (request) {
   return new Promise(
      function (resolve) {
         this.push({
            resolve: function () {
               resolve(request);
            },
         });
      }.bind(this)
   );
};

AxiosRateLimit.prototype.handleResponse = function (response) {
   this.inProcessing -= 1;
   if (this.onResponse) {
      setTimeout(() => {
         this.onResponse(this.inProcessing, this.queue.length, this.reqsPs, this.retriesPs);
      }, 0);
   }
   this.shift();
   return response;
};

AxiosRateLimit.prototype.push = function (requestHandler) {
   this.queue.push(requestHandler);
   if (this.onPush) {
      setTimeout(() => {
         this.onPush(this.inProcessing, this.queue.length, this.reqsPs, this.retriesPs);
      }, 0);
   }
   this.shiftInitial();
};

AxiosRateLimit.prototype.shiftInitial = function () {
   setTimeout(
      function () {
         return this.shift();
      }.bind(this),
      0
   );
};

AxiosRateLimit.prototype.shift = function () {
   if (!this.queue.length) {
      if (this.onQueueEmpty) {
         setTimeout(() => {
            this.onQueueEmpty(this.inProcessing, this.queue.length, this.reqsPs, this.retriesPs);
         }, 0);
      }
      return;
   }
   if (this.timeslotRequests === this.maxRequests) {
      if (this.timeoutId && typeof this.timeoutId.ref === "function") {
         this.timeoutId.ref();
      }
      if (this.onLimitReached) {
         setTimeout(() => {
            this.onLimitReached(this.inProcessing, this.queue.length, this.reqsPs, this.retriesPs);
         }, 0);
      }
      return;
   }

   var queued = this.queue.shift();
   if (this.onSend) {
      setTimeout(() => {
         this.onSend(this.inProcessing, this.queue.length, this.reqsPs, this.retriesPs);
      }, 0);
   }
   queued.resolve();

   if (this.timeslotRequests === 0) {
      this.timeoutId = setTimeout(
         function () {
            this.timeslotRequests = 0;
            this.shift();
         }.bind(this),
         this.perMilliseconds
      );

      if (typeof this.timeoutId.unref === "function") {
         if (this.queue.length === 0) this.timeoutId.unref();
      }
   }

   this.timeslotRequests += 1;
   this.inProcessing += 1;
   this.requestCounter += 1;
};

AxiosRateLimit.prototype.onRetry = function (retryCount) {
   this.retriesCounter += 1;
   if (this.onRetry) {
      setTimeout(() => {
         this.onRetry(retryCount);
      }, 0);
   }
   return 0;
};

/**
 * Apply rate limit to axios instance.
 *
 * @example
 *   import axios from 'axios';
 *   import rateLimit from 'axios-rate-limit';
 *
 *   // sets max 2 requests per 1 second, other will be delayed
 *   // note maxRPS is a shorthand for perMilliseconds: 1000, and it takes precedence
 *   // if specified both with maxRequests and perMilliseconds
 *   const http = rateLimit(axios.create(), { maxRequests: 2, perMilliseconds: 1000, maxRPS: 2 })
 *    http.getMaxRPS() // 2
 *   http.get('https://example.com/api/v1/users.json?page=1') // will perform immediately
 *   http.get('https://example.com/api/v1/users.json?page=2') // will perform immediately
 *   http.get('https://example.com/api/v1/users.json?page=3') // will perform after 1 second from the first one
 *   http.setMaxRPS(3)
 *   http.getMaxRPS() // 3
 *   http.setRateLimitOptions({ maxRequests: 6, perMilliseconds: 150 }) // same options as constructor
 *
 * @param {Object} axios axios instance
 * @param {Object} options options for rate limit, available for live update
 * @param {Number} options.maxRequests max requests to perform concurrently in given amount of time.
 * @param {Number} options.perMilliseconds amount of time to limit concurrent requests.
 * @returns {Object} axios instance with interceptors added
 */
function axiosRateLimit(axios, options) {
   var rateLimitInstance = new AxiosRateLimit(axios);
   rateLimitInstance.setRateLimitOptions(options);

   axios.getMaxRPS = AxiosRateLimit.prototype.getMaxRPS.bind(rateLimitInstance);
   axios.setMaxRPS = AxiosRateLimit.prototype.setMaxRPS.bind(rateLimitInstance);
   axios.setRateLimitOptions = AxiosRateLimit.prototype.setRateLimitOptions.bind(rateLimitInstance);

   axiosRetry(axios, { retries: options.retries, retryDelay: AxiosRateLimit.prototype.onRetry.bind(rateLimitInstance) });

   return axios;
}

// eslint-disable-next-line no-undef
module.exports = axiosRateLimit;
