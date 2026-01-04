import TaskBoard from "../TaskBoard";
import { useTasks } from "../TaskStore";

function TasksPage() {
  const { tasks, addTask, updateTask } = useTasks();

  return (
    <main style={{ padding: 24 }}>
      <TaskBoard tasks={tasks} addTask={addTask} updateTask={updateTask} />
    </main>
  );
}

export default TasksPage;
