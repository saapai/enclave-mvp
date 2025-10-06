// Centralized logging system
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, any>
  error?: Error
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development'
  private isProduction = process.env.NODE_ENV === 'production'

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error
    }

    // In development, log to console
    if (this.isDevelopment) {
      const consoleMethod = level === 'debug' ? 'log' : level
      console[consoleMethod](`[${level.toUpperCase()}] ${message}`, context || '', error || '')
    }

    // In production, you might want to send to external logging service
    if (this.isProduction && level === 'error') {
      // TODO: Send to external logging service (e.g., Sentry, LogRocket)
      console.error(JSON.stringify(entry))
    }
  }

  debug(message: string, context?: Record<string, any>) {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, any>) {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, any>) {
    this.log('warn', message, context)
  }

  error(message: string, error?: Error, context?: Record<string, any>) {
    this.log('error', message, context, error)
  }
}

export const logger = new Logger()