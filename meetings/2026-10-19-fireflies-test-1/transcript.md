# Fireflies test 1

**Meeting Date:** Oct 19, 2026 4:24 PM

---

**Binura Ranasinghe** *[00:03]*: You'll just use your normal Gmail account. Click sign in and this will pop us back into integravity. Alright, so now we're vlogging. We're going to introduce you to a key concept of anti gravity, which is that there are three main surfaces.

**Binura Ranasinghe** *[00:18]*: The first one is called the Agent Manager. This is a place for you to manage and create agents across all of your workspaces. There is one agent manager. Now, if you want to get into the code, you want to take over from the agent, for example, and bring that task from 90% to 100%, you can at any point press Command E or press the Open and editor button.

**Binura Ranasinghe** *[00:38]*: And this will take you into the Anti Gravity editor which has things like tab, autocomplete everything you've come to know. Finally, there is a browser. This is a random incorporates directly inside of so you can ask questions like test my feature and the agent manager or the editor will spawn a browser and click on the screen, scroll on the screen to basically test the products that you're building. This is a really, really powerful way to bring all that context, that rich context of applications and docs directly into the agent.

**Binura Ranasinghe** *[01:15]*: So we're going to go with Agent Assisted Deployment. What this means is the LLM will automatically decide if something is worth our attention. If something is very, very easy, the agent will just go off and implement it and come back at the end. But for some things that are more complicated or if it has questions it might ask us, hey, why don't you take a look at this, answer a few questions about your code base that I couldn't figure out and then go off and execute.

**Binura Ranasinghe** *[01:36]*: So it's a different way of working. This is my preferred way. So now that we finished onboarding, let's go ahead and get started on our first. You'll notice on the left side there is a sidebar and we're going to go ahead and add a new workspace.

**Binura Ranasinghe** *[01:51]*: We're going to be working locally instead of in ssh. So let's create a new folder. We'll just call it FlightTracker. And today we're going to be building a flight tracker app where a user can add their flight number and it will directly integrate with your Google Calendar to basically add that flight information to your calendar directly.

**Binura Ranasinghe** *[02:10]*: Build me a flight lookup Next JS web app. The user can put in a flight number and the app gives you the start time, end time, time zone, start location and end location flight. For now, use a mock API that returns a list of matching flights. Display the search results under the form info.

**Binura Ranasinghe** *[02:27]*: So it's going to start. And remember the setting that we chose for the agent to be making decisions on the user's behalf. Because we chose that auto setting, this means that the agent is capable of running terminal commands on our behalf without our approval. Now, if this command was something a bit more sophisticated, we want to build that trust with you as the user.

**Binura Ranasinghe** *[02:45]*: And so we'll obviously notify you to approve or deny that specific website. So we'll go off. It looks like we want to run create next app and the agent will now start doing work on your behalf in the background. But you can always check in on its progress.

**Binura Ranasinghe** *[02:59]*: And one of the really, really cool features for Anti Gravity is this notion of artifacts. So if you click the right sidebar and this is available both in the editor and the agent manager, you'll notice the agent is putting together artifacts. These are markdown files for the agent to sort of track its own progress, do research, and even generate findings. We see that the agent is keeping its own task list to keep track of its progress.

**Binura Ranasinghe** *[03:23]*: And this is something that you can also follow along with. We have instrumented the Anti Gravity agent to work with three main artifacts. Debug.

