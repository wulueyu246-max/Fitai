class AppException implements Exception {
  const AppException({
    required this.code,
    required this.userMessage,
    this.technicalMessage,
    this.cause,
  });

  final String code;
  final String userMessage;
  final String? technicalMessage;
  final Object? cause;

  @override
  String toString() => '$code: ${technicalMessage ?? userMessage}';
}
