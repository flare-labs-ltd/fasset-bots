import { ConsoleNotifierTransport, LoggerNotifierTransport } from "../../src/utils/notifier/NotifierTransports";

export const testNotifierTransports = [
    new ConsoleNotifierTransport(),
    new LoggerNotifierTransport(),
];
