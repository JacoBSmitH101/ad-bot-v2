export class DomainError extends Error {
    constructor(code, message) {
        super(message ?? code);
        this.name = "LogicalError";
        this.code = code;
    }
}
