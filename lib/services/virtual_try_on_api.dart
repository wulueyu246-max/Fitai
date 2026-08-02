import '../models/try_on_request.dart';
import '../models/try_on_result.dart';
import '../models/virtual_try_on_task.dart';
import 'virtual_try_on_service.dart';

abstract interface class VirtualTryOnAPI {
  Future<VirtualTryOnTask> createTask(TryOnRequest request);

  Future<VirtualTryOnTask> getTaskStatus(String taskId);

  Future<TryOnResult> getResult(String taskId);
}

class ServiceBackedVirtualTryOnAPI implements VirtualTryOnAPI {
  ServiceBackedVirtualTryOnAPI(this.service);

  final VirtualTryOnService service;
  final Map<String, VirtualTryOnTask> _completedTasks = {};

  @override
  Future<VirtualTryOnTask> createTask(TryOnRequest request) {
    return service.createTask(request);
  }

  @override
  Future<VirtualTryOnTask> getTaskStatus(String taskId) async {
    final task = await service.getStatus(taskId);
    if (task.isComplete) {
      _completedTasks[taskId] = task;
    }
    return task;
  }

  @override
  Future<TryOnResult> getResult(String taskId) async {
    final task = _completedTasks[taskId];
    if (task == null) {
      return service.getResult(taskId);
    }
    if (task.status != VirtualTryOnTaskStatus.success ||
        task.imageUrl == null) {
      throw VirtualTryOnAPIException(task.error ?? '试穿结果尚未生成');
    }
    return TryOnResult(
      id: task.id,
      image: task.imageUrl!,
      createdTime: DateTime.now(),
      isMock: task.isMock,
    );
  }
}

class VirtualTryOnAPIException implements Exception {
  const VirtualTryOnAPIException(this.message);

  final String message;

  @override
  String toString() => message;
}
