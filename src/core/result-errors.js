// Trusted, service-owned result absence signal. A transport may classify this
// without parsing flattened user/provider error text or exposing storage details.
export class RetainedResultNotFound extends TypeError {
  constructor(){
    super('That result was not found. Results are kept for 24 hours and only for the connection that made them; run the search again.');
    this.name='RetainedResultNotFound';
  }
}
