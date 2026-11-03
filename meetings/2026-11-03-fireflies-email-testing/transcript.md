# fireflies-email-testing

**Meeting Date:** Nov 3, 2026 8:10 AM

---

**Binura Ranasinghe** *[00:13]*: This is Zed's brand new agent sidewalk. If you haven't opened Zed file, you'll see this little message looking for threads from external pages. This will let you import things from like cloud code, codecs, any other third party stuff that might happen. I've got a few of those insulting.

**Binura Ranasinghe** *[00:26]*: You can see I've got amp claude codecs, cursor, open code, all of those installed. So I'm going to hit import threads and that will kick off importing the threads from every one of those third party agents. And now I have all the threads I did and accessible I find from this thread. In the new cycle I'll go ahead and open a project to get started.

**Binura Ranasinghe** *[00:45]*: I'm going to pick Z. You can see in our thread sidebar we have no threads yet. You want a little more real estate Here you can expand this to full screen mode. And now we're sort of focusing on the agent and what I'm going to type.

**Binura Ranasinghe** *[00:57]*: Tell me about this project based on the repeat. But what's new is that while this is running I can now stop it over here in the sidebar or I can just kick off other thread. This time instead of using the Z agent, I'm going to go ahead and use Claude what's in the revolution. And while that's running, I can go ahead and click off another agent thread.

**Binura Ranasinghe** *[01:20]*: This one we're going to kick off with. Sure, let's use Cursor's agent and let's say what's in the readme. As you can see, these other cheek threads finished. That's why we got the little blue dot.

**Binura Ranasinghe** *[01:32]*: This is sort of like an unread indicator. So when I click on it, blue dot goes away and is replaced by the agent's icon. So now I can see, oh, this was flood agent finishing and this was the original agent finishing. As you can see, all these have a pretty consistent format to what they're looking like.

**Binura Ranasinghe** *[01:47]*: Of course the results can be different because each agent has its own method of coming up with output. But the point is that I can run all these agents in parallel without needing to open separate Z windows for them like I would have previously. By the way, if you toggle the project panel, you may notice that by default it's now on the right. That's because we wanted it to be able to be open at the same time as the sidebar.

**Binura Ranasinghe** *[02:08]*: But if you want to put it back, you can always right click and just change it to docker left. And no problem, I'm going to put it back on the right. And by the way, you can do that with any panel on Zed, any panel. If we want, we can put that as well.

**Binura Ranasinghe** *[02:22]*: But I'm just going to leave it over here for now. So now I'm going to add a new folder to this project which is going to be z.dev so now I have both are Zed the actual client as well as zed.dev website. And now not only can I switch between these two as sort of my main project, but I can actually start new agents that are working on both of them. This is one project with two folders in it, but I can also open a second project if I want to.

**Binura Ranasinghe** *[02:49]*: So let's open up this planets directory here and I'm going to start a new thread on this one and this one I'm actually going to open in a new gitboard tree, let's say a create the work tree based on main. It's generated some random name here. So this is a random adjective called by a random noun. If I open up my terminal, see that it's created in this worktrees directory.

**Binura Ranasinghe** *[03:13]*: So the planets directory was in my home code directory. It basically made a new directory in here called work trees for all of your Z work trees and then planets being the name of this project and then opened being the randomly generated name that we happen to choose for this work tree git. Work trees are pretty nice because they're basically a way to take a existing checkout. So in this case, this is the checkout of origin main and make a new checkout in a new folder that sort of git is able to manage local.

**Binura Ranasinghe** *[03:41]*: Now by default this doesn't have a branch, we can add one later. But the point is that I now have a completely fresh checkout group. And so if I have an agent working on this thing, like for example, if I spin up a new agent and I just say tell me about this project, switch back to my other project and I can also make a new work tree on here. So it's going to create work trees not only for this repo, the Z client, but also another work tree for the z.dev website.

**Binura Ranasinghe** *[04:12]*: So now I have a fresh checkout for both Z.dev as well as the ZProf. So now when I run my agent on this, it's going to be working on this new folder, a fresh checkout for both of those projects and not affect anything on my original repository checkouts. So I'm going to give it something to chew on here, please rename the concept of extensions to plugins. This is going to take a little bit of time.

**Binura Ranasinghe** *[04:39]*: If I take this out of full screen mode then I can and then follow the Zed agent and I can actually just watch real time and see what kind of edits it's making. Certainly it's gonna be a whole lot of going around and changing strings from extensions to plugins and so forth. I can also go ahead and do a git branch diff. So this will give me a better view of what this diff is looking like with the original branch.

**Binura Ranasinghe** *[05:04]*: In this case that would be main. Notice by the way, that I've still got my stuff running over here. It's still making its changes, but I can go do my git diff at any time. Nice side by side diff here.

**Binura Ranasinghe** *[05:15]*: Extensions, plugins, extensions, plugins, etc. And once I'm all done with all that, maybe I'll go ahead and stop. Oh, that's good enough. Since this is just an experiment, I can now open my git panel and I can stage these.

**Binura Ranasinghe** *[05:29]*: But if I were to commit them right now, this would not go on any particular branch. We have actually created one and go to my workfeece and just make one here. Okay, now we're on the plugins branch and I can go ahead and commit to plugins, right? And if I wanted to push this up, I just press this publish button.

**Binura Ranasinghe** *[05:48]*: Once I'm all done with this, I might say, okay, let me just go ahead and clean up this thread. Since I'm not using it anymore, I can press this archive thread button over here. This is a nice thing to do both to keep my sidebar uncluttered, but also to potentially reclaim some storage space like disk. If I press this archive thread button, what happens is not only does the thread disappear from my sidebar, but also it's going to take everything that was in that folder and also things that were uncommitted and basically move them into git storage as like a little sort of behind the scenes commit.

**Binura Ranasinghe** *[06:16]*: And that way basically temporary directories like build directories and stuff like that will get deleted. So they're not taking a disk space anymore. But if I want to back, I can always go back down here and show thread history and bring it right back. If I don't want it back, I can hit delete thread.

**Binura Ranasinghe** *[06:31]*: If I do want it back, I just click on it. It's going to bring it back. Everything is right back on disk. And in fact I can see the same git diff as before, I'm basically right back in the state where I was before I pressed the archive button, except that all my git ignoring directories have been deleted, which is a nice space save.

**Binura Ranasinghe** *[06:46]*: Finally, if you want to just dive in, we just find Cyborg right here at your fingertips. You got all the usual Z features. Personally, I believe this thing is open all the time because it's just a really nice way to jump between multiple different projects and all the different pages and stuff I've got running on. Hope you enjoy.

**Binura Ranasinghe** *[07:41]*: It's.

