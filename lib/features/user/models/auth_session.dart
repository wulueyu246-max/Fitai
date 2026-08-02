class AuthSession {
  const AuthSession({
    required this.userId,
    required this.token,
    required this.createdAt,
    required this.expiresAt,
    this.isMock = true,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      userId: json['userId'] as String,
      token: json['token'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      isMock: json['isMock'] as bool? ?? true,
    );
  }

  final String userId;
  final String token;
  final DateTime createdAt;
  final DateTime expiresAt;
  final bool isMock;

  bool get isExpired => DateTime.now().isAfter(expiresAt);

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'token': token,
        'createdAt': createdAt.toIso8601String(),
        'expiresAt': expiresAt.toIso8601String(),
        'isMock': isMock,
      };
}
