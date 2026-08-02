enum VirtualTryOnTaskStatus {
  waiting,
  generating,
  success,
  failed,
}

class VirtualTryOnTask {
  const VirtualTryOnTask({
    required this.id,
    required this.status,
    required this.createdTime,
    this.imageUrl,
    this.error,
    this.isMock = false,
    this.progress = 0,
    this.provider = 'mock',
  });

  final String id;
  final VirtualTryOnTaskStatus status;
  final DateTime createdTime;
  final String? imageUrl;
  final String? error;
  final bool isMock;
  final double progress;
  final String provider;

  bool get isComplete =>
      status == VirtualTryOnTaskStatus.success ||
      status == VirtualTryOnTaskStatus.failed;

  factory VirtualTryOnTask.fromJson(Map<String, dynamic> json) {
    final rawStatus = json['status'] as String?;
    return VirtualTryOnTask(
      id: json['id'] as String,
      status: rawStatus == 'queued'
          ? VirtualTryOnTaskStatus.waiting
          : VirtualTryOnTaskStatus.values.firstWhere(
              (status) => status.name == rawStatus,
              orElse: () => VirtualTryOnTaskStatus.failed,
            ),
      createdTime: DateTime.parse(json['createdTime'] as String),
      imageUrl: json['imageUrl'] as String?,
      error: json['error'] as String?,
      isMock: json['isMock'] as bool? ?? false,
      progress: (json['progress'] as num?)?.toDouble() ?? 0,
      provider: json['provider'] as String? ?? 'unknown',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'status': status.name,
      'createdTime': createdTime.toIso8601String(),
      'imageUrl': imageUrl,
      'error': error,
      'isMock': isMock,
      'progress': progress,
      'provider': provider,
    };
  }
}
