// Error from a WhatsApp provider, already in friendly Indonesian; `status` is the HTTP status the route should answer.
export class WaError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
