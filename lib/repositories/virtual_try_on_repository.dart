import '../models/try_on_request.dart';
import '../models/try_on_result.dart';
import '../models/virtual_try_on_task.dart';
import '../services/virtual_try_on_api.dart';

abstract interface class VirtualTryOnRepository {
  Future<TryOnResult> generateAndWait(TryOnRequest request);
}

class PollingVirtualTryOnRepository implements VirtualTryOnRepository {
  const PollingVirtualTryOnRepository({
    required this.api,
    this.pollInterval = const Duration(milliseconds: 250),
    this.maxAttempts = 80,
  });

  final VirtualTryOnAPI api;
  final Duration pollInterval;
  final int maxAttempts;

  @override
  Future<TryOnResult> generateAndWait(TryOnRequest request) async {
    var task = await api.createTask(request);
    for (var attempt = 0;
        attempt < maxAttempts && !task.isComplete;
        attempt++) {
      await Future<void>.delayed(pollInterval);
      task = await api.getTaskStatus(task.id);
    }
    if (task.status != VirtualTryOnTaskStatus.success ||
        task.imageUrl == null) {
      throw VirtualTryOnRepositoryException(
        task.error ?? '试穿任务超时，请稍后重试',
      );
    }
    return api.getResult(task.id);
  }
}

class VirtualTryOnRepositoryException implements Exception {
  const VirtualTryOnRepositoryException(this.message);

  final String message;

  @override
  String toString() => message;
}
